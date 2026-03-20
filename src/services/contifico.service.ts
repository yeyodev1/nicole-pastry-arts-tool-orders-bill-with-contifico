import axios, { HttpStatusCode } from "axios";
import { IPerson } from "../interfaces/person.interface";

export class ContificoService {
  private apiKey: string;
  private token: string;
  private baseUrl: string = "https://api.contifico.com/sistema/api/v1";
  // POS (Punto de Venta) ID para la cuenta — cada empresa tiene el suyo
  private posId: string;
  // Identifica qué cuenta de Contífico maneja esta instancia
  readonly source: 'nicole' | 'sucree';

  constructor(source: 'nicole' | 'sucree' = 'nicole') {
    this.source = source;

    // Seleccionar credenciales y POS según el negocio
    if (source === 'sucree') {
      this.apiKey = process.env.CONTIFICO_SUCREE_API_KEY || "";
      this.token = process.env.CONTIFICO_SUCREE_TOKEN || "";
      this.posId = process.env.CONTIFICO_SUCREE_POS_ID || "";
    } else {
      // Default: Nicole (negocio principal)
      this.apiKey = process.env.CONTIFICO_API_KEY || "";
      this.token = process.env.CONTIFICO_TOKEN || "";
      this.posId = process.env.CONTIFICO_POS_ID || "00f60268-ca0c-48f9-8768-4f2625fa975a";
    }

    if (!this.apiKey || !this.token) {
      console.warn(`⚠️ Contífico credentials missing for source '${source}' in .env`);
    }
    // posId puede estar vacío — se auto-detecta desde /caja/ en el primer uso si no está configurado.
  }

  // --- CACHE POR INSTANCIA (evita que Nicole y Sucree compartan caché) ---
  private cachedProducts: any[] | null = null;
  private cachedProductsTime: number = 0;
  private static readonly PRODUCTS_TTL = 3600 * 1000; // 1 hora

  private cachedCategories: any[] | null = null;
  private cachedCategoriesTime: number = 0;
  private static readonly CATEGORIES_TTL = 3600 * 1000; // 1 hora

  // POS ID auto-detectado desde la API de Contífico (una vez por instancia)
  private resolvedPosId: string = "";
  private posIdResolved: boolean = false;

  /**
   * Retorna productos cacheados o frescos si el TTL expiró.
   */
  async getCachedProducts(result_size: number = 2000) {
    const now = Date.now();
    if (this.cachedProducts && (now - this.cachedProductsTime < ContificoService.PRODUCTS_TTL)) {
      return this.cachedProducts;
    }

    const products = await this.getProducts({ result_size });
    if (products) {
      this.cachedProducts = products;
      this.cachedProductsTime = now;
    }
    return products || [];
  }

  /**
   * Retorna categorías cacheadas o frescas si el TTL expiró.
   */
  async getCachedCategories() {
    const now = Date.now();
    if (this.cachedCategories && (now - this.cachedCategoriesTime < ContificoService.CATEGORIES_TTL)) {
      return this.cachedCategories;
    }

    const categories = await this.getCategories();
    if (categories) {
      this.cachedCategories = categories;
      this.cachedCategoriesTime = now;
    }
    return categories || [];
  }

  /**
   * Create an invoice in Contífico
   */
  async createInvoice(orderData: any) {
    try {
      // 1. Calculate Per-Item Values and Totals
      let subtotal_0 = 0;
      let subtotal_15 = 0; // Using subtotal_12 variable name for legacy compatibility if needed, map to subtotal_12 in payload
      let total_iva = 0;
      let total_final = 0;

      const detalles = orderData.products.map((p: any) => {
        const cantidad = Number(p.quantity);
        const precio = Number(p.price);
        // const totalLine = cantidad * precio; // This line will be moved/recalculated later

        // Check if product is Delivery
        const isDelivery = p.name.toLowerCase().includes('delivery');

        // CONTIFICO CONFIG: Delivery is 15% Taxable.
        // User wants $5.00 flat. We must treat price as "Tax Inclusive".
        let hasIva = !isDelivery; // Default logic

        if (isDelivery) {
          hasIva = true; // Force True to satisfy API (Avoid Error 1098)
          // Back-calculate price so Total = User Price
          // Price = 5 / 1.15 = 4.3478
          // Tax = 0.6521
          // Total = 5.00
          // We modify the 'precio' variable used for calculation here
          // Note: 'precio' incoming is unit price.
        }

        const porcentaje_iva = hasIva ? 15 : 0;

        // Recalculate values if Delivery (Inclusive)
        let calcPrice = precio;
        if (isDelivery && hasIva) {
          calcPrice = precio / 1.15;
        }

        // Apply Discount Logic (Courtesy = 100%)
        let discountPercentage = p.isCourtesy ? 100 : 0;

        // Apply Global Overrides
        if (orderData.isGlobalCourtesy) {
          discountPercentage = 100;
        } else if (orderData.globalDiscountPercentage > 0 && discountPercentage < 100) {
          discountPercentage = orderData.globalDiscountPercentage;
        }

        // Total Line = Qty * Price * (1 - Discount/100)
        // If 100% discount, totalLine becomes 0, so it doesn't add to the invoice totals
        const totalLine = cantidad * calcPrice * ((100 - discountPercentage) / 100);

        let base_cero = 0;
        let base_gravable = 0;
        let base_no_gravable = 0;

        if (porcentaje_iva > 0) {
          base_gravable = Number(totalLine.toFixed(2)); // Round Base to 2 decimals
          subtotal_15 += base_gravable;
          // NOTE: Do NOT accumulate per-line rounded IVA here.
          // total_iva is computed once from subtotal_15 after the loop
          // to avoid 1-cent rounding discrepancies with Contifico's validation.
        } else {
          base_cero = Number(totalLine.toFixed(2)); // Round Base 0 to 2 decimals
          subtotal_0 += base_cero;
        }

        return {
          producto_id: p.contifico_id || "9pgenB6GQcVWoeNQ", // Fallback to test product if missing, but should be mapped
          cantidad: cantidad,
          // For Contifico, if we want to force the price, we just send it.
          // However, verify if 'pvp_manual' is needed or if sending 'precio' is enough.
          // Documentation says 'precio' is the unit price.
          precio: Number(calcPrice.toFixed(4)), // High precision for unit price
          descripcion: p.name,
          porcentaje_iva: porcentaje_iva,
          base_cero: base_cero,
          base_gravable: base_gravable,
          base_no_gravable: base_no_gravable,
          descuento: discountPercentage
        };
      });

      // Compute total_iva ONCE from the total taxable base (not sum of per-line rounded IVAs).
      // This ensures our `iva` field matches what Contifico recomputes from line bases,
      // preventing the "saldos de debe y haber no cuadran" 1-cent error.
      total_iva = Number((subtotal_15 * 0.15).toFixed(2));
      total_final = subtotal_0 + subtotal_15 + total_iva;

      // 2. Prepare Payload
      // Generating a random document number (sequence) to avoid collisions during dev.
      // IN PROD: You should query the sequence or use auto-generation if supported.
      const randomSeq = Math.floor(Math.random() * 900000) + 100000;
      const docNumber = `001-001-000${randomSeq}`;

      // POS ID de la cuenta Contífico correspondiente.
      // Se obtiene de env var o se auto-detecta desde /caja/ (una vez, cacheado por instancia).
      const POS_DULCERIA_ID = await this.resolvePosId();

      // Identificación del cliente para la factura.
      // Se usa personType para determinar el tipo de persona y calcular correctamente RUC y cédula.
      const rawId = (orderData.invoiceData?.ruc || "").trim();
      const personType = orderData.invoiceData?.personType;

      let computedRuc: string;
      let computedCedula: string;

      if (personType === 'juridica') {
        // Persona Jurídica: RUC de 13 dígitos, sin cédula
        computedRuc = rawId;
        computedCedula = "";
      } else {
        // Persona Natural (default si no hay personType o es 'natural')
        if (rawId.length === 10) {
          // Cédula: el RUC del SRI es cédula + "001"
          computedRuc = rawId + "001";
          computedCedula = rawId;
        } else {
          // RUC de persona natural (13 dígitos, termina en 001)
          computedRuc = rawId;
          computedCedula = rawId.slice(0, 10);
        }
      }

      const clientePayload = {
        razon_social: orderData.invoiceData?.businessName,
        ruc: computedRuc,
        cedula: computedCedula,
        email: orderData.invoiceData?.email,
        direccion: orderData.invoiceData?.address,
        tipo: "C",
        telefonos: orderData.customerPhone
      };

      const payload = {
        pos: POS_DULCERIA_ID,
        fecha_emision: new Date().toLocaleDateString("en-GB"), // DD/MM/YYYY
        tipo_documento: "FAC",
        documento: docNumber,
        estado: "P",
        electronico: true,
        autorizacion: "",
        cliente: clientePayload,
        detalles: detalles.map((d: any) => ({
          ...d,
          porcentaje_descuento: d.descuento,
          descuento: undefined
        })),
        subtotal_0: Number(subtotal_0.toFixed(2)),
        subtotal_12: 0,
        subtotal_15: Number(subtotal_15.toFixed(2)),
        iva: Number(total_iva.toFixed(2)),
        ice: 0,
        total: Number(total_final.toFixed(2)),
        servicio: 0,
        propina: 0,
        metodo_pago: "TRA"
      };


      const response = await axios.post(`${this.baseUrl}/documento/`, payload, {
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
        },
      });

      return response.data;
    } catch (error: any) {
      console.error("❌ Error creating invoice in Contífico:", error.response?.data || error.message);
      // Return error info instead of throwing to avoid blocking order creation flow
      return { error: error.response?.data || error.message };
    }
  }

  /**
   * Get products from Contífico
   * @param options Search options (filtro, codigo_barra, categoria_id)
   */
  async getProducts(options: { filtro?: string; codigo_barra?: string; categoria_id?: string; result_size?: number; result_page?: number } = {}) {
    try {
      const params: any = {};

      if (options.filtro) params.filtro = options.filtro;
      if (options.codigo_barra) params.codigo_barra = options.codigo_barra;
      if (options.categoria_id) params.categoria_id = options.categoria_id;
      if (options.result_size) params.result_size = options.result_size;
      if (options.result_page) params.result_page = options.result_page;


      const response = await axios.get(`${this.baseUrl}/producto/`, {
        headers: {
          Authorization: this.apiKey,
        },
        params,
      });

      return response.data;
    } catch (error: any) {
      console.error("❌ Error fetching products from Contífico:", error.response?.data || error.message);
      const err = new Error("Failed to fetch products from Contífico") as any;
      err.contificoStatus = error.response?.status ?? null;
      throw err;
    }
  }

  async getCategories() {
    try {
      const response = await axios.get(`${this.baseUrl}/categoria/`, {
        headers: {
          Authorization: this.apiKey,
        },
      });
      return response.data;
    } catch (error: any) {
      console.error("❌ Error fetching categories from Contífico:", error.response?.data || error.message);
      throw new Error("Failed to fetch categories from Contífico");
    }
  }

  /**
   * Get person from Contífico (Search by ID or Name)
   * @param query Search query (RUC, Cedula, or Name)
   */
  async getPerson(query: string) {
    try {

      const params: any = {};

      // Basic heuristic: if it contains only numbers, search by identificacion
      // otherwise search by filtro (name/razon social)
      const isNumeric = /^\d+$/.test(query);

      if (isNumeric) {
        params.identificacion = query;
      } else {
        params.filtro = query;
      }

      const response = await axios.get(`${this.baseUrl}/persona/`, {
        headers: {
          Authorization: this.apiKey,
        },
        params: params,
      });

      return response.data;
    } catch (error: any) {
      console.error("❌ Error fetching person from Contífico:", error.response?.data || error.message);
      // Don't throw unique error, just return empty list or propagate error safely
      if (error.response?.status === 404) {
        return [];
      }
      throw new Error("Failed to fetch person from Contífico");
    }
  }

  /**
   * Create a new person in Contífico
   * @param personData Person data (ruc, razon_social, email, etc.)
   */
  async createPerson(personData: IPerson): Promise<IPerson> {
    try {

      // If tipo is not provided, infer from length
      const tipo = personData.tipo || (personData.ruc.length === 13 ? "J" : "N");

      const payload: IPerson = {
        ...personData,
        tipo: tipo,
        es_cliente: true,
        es_proveedor: false,
        es_empleado: false,
        es_vendedor: false,
        es_extranjero: false
      };

      // Identify cedula vs ruc logic
      if (tipo === "N") {
        payload.cedula = personData.ruc; // Map our 'ruc' input to 'cedula' field for API
        payload.ruc = ""; // Clear RUC to avoid API conflicts if strictly N
      } else {
        payload.ruc = personData.ruc;
        payload.cedula = "";
      }

      const response = await axios.post(`${this.baseUrl}/persona/`, payload, {
        headers: {
          Authorization: this.apiKey,
        },
      });

      return response.data;
    } catch (error: any) {
      console.error("❌ Error creating person in Contífico:", error.response?.data || error.message);
      throw new Error("Failed to create person in Contífico: " + (error.response?.data?.mensaje || error.message));
    }
  }

  /**
   * Register a collection (cobro) for a document
   * @param documentId The Contífico Document ID
   * @param collectionData The collection data payload
   */
  async registerCollection(documentId: string, collectionData: any) {
    try {
      // Format date to DD/MM/YYYY if needed
      let formattedDate = collectionData.fecha;
      if (collectionData.fecha && collectionData.fecha.includes('-')) {
        // Assume YYYY-MM-DD
        const [year, month, day] = collectionData.fecha.split('-');
        formattedDate = `${day}/${month}/${year}`;
      }

      // Ensure we use the formatted date
      const payload = {
        ...collectionData,
        fecha: formattedDate
      };

      // 1057 Error Fix: Falta campo caja
      // If no caja_id is provided, try to find one
      if (!payload.caja_id) {
        const cajas = await this.getCajas();

        if (cajas && cajas.length > 0) {
          // Usar el POS de esta cuenta (auto-detectado o configurado por env var)
          const PREFERRED_POS_ID = await this.resolvePosId();

          // Strategy: Find ALL sessions for our POS and pick the LATEST one.
          // We ignore 'fecha_cierre' because sometimes active sessions have it populated.
          const posSessions = cajas.filter((c: any) => c.pos === PREFERRED_POS_ID);

          let targetCajaId = "";

          if (posSessions.length > 0) {
            // Assume the list is chronological or sort it? API usually returns chronological.
            // Taking the last one is the safest bet for "most recent".
            const latestSession = posSessions[posSessions.length - 1];
            targetCajaId = latestSession.id;
          } else {
            // Fallback to the very first caja in the list if no match for POS
            targetCajaId = cajas[0].id;
          }

          payload.caja_id = targetCajaId;

        } else {
          console.warn("⚠️ No Cajas found in Contífico account.");
        }
      }

      // FIX: Resolve Bank Account ID for Transfer 'TRA'
      if (payload.forma_cobro === 'TRA') {
        const providedId = payload.cuenta_bancaria_id;
        // Check if it looks like a name (contains spaces) or is empty
        // ID is usually short alphanumeric. Names have spaces.
        const looksLikeName = providedId && (providedId.includes(' ') || providedId.length > 25);

        if (!providedId || looksLikeName) {
          const banks = await this.getBankAccounts();

          if (banks && banks.length > 0) {
            let match;
            if (providedId) {
              match = banks.find((b: any) => b.nombre?.toLowerCase().includes(providedId.toLowerCase()));
            }

            // Default to first if not found or no name provided
            if (!match) {
              console.warn(`⚠️ Bank '${providedId}' not found. Using first available bank account.`);
              match = banks[0];
            }

            if (match) {
              payload.cuenta_bancaria_id = match.id;

              // Ensure tipo_ping is set (D = Deposito)
              if (!payload.tipo_ping) payload.tipo_ping = "D";
            }
          } else {
            console.error("❌ No Bank Accounts found in Contífico. Transfer registration may fail.");
          }
        }
      }


      const response = await axios.post(`${this.baseUrl}/documento/${documentId}/cobro/`, payload, {
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
        },
      });

      return response.data;
    } catch (error: any) {
      console.error("❌ Error registering collection in Contífico:", error.response?.data || error.message);
      // Return error structure to be handled by controller
      throw new Error(error.response?.data?.mensaje || "Failed to register collection in Contífico");
    }
  }

  /**
   * Get documents (movements) from Contífico
   * @param options Search filters (fecha_emision, tipo, persona_id, etc.)
   */
  async getDocuments(options: { fecha_emision?: string; tipo?: string; persona_identificacion?: string;[key: string]: any } = {}) {
    try {

      const params = { ...options };

      const response = await axios.get(`${this.baseUrl}/documento/`, {
        headers: {
          Authorization: this.apiKey,
        },
        params: params,
      });

      return response.data;
    } catch (error: any) {
      console.error("❌ Error fetching documents from Contífico:", error.response?.data || error.message);
      // Handle 404 as empty list if Contífico returns 404 for no results
      if (error.response?.status === 404) {
        return [];
      }
      throw new Error("Failed to fetch documents from Contífico");
    }
  }

  /**
   * Get specific document by ID
   * @param id Document ID
   */
  async getDocument(id: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/documento/${id}/`, {
        headers: { Authorization: this.apiKey }
      });
      return response.data;
    } catch (error: any) {
      console.error("❌ Error fetching document from Contífico:", error.response?.data || error.message);
      throw new Error(error.response?.data?.mensaje || "Failed to fetch document");
    }
  }

  /**
   * Resuelve el POS ID para esta cuenta Contífico.
   * Prioridad: env var → auto-detección por frecuencia en /caja/ → primer caja disponible.
   * El resultado queda cacheado por instancia (una sola llamada a la API por ciclo de vida).
   */
  async resolvePosId(): Promise<string> {
    if (this.posIdResolved) return this.resolvedPosId;

    // Si viene configurado por env var, usarlo directamente
    if (this.posId) {
      this.resolvedPosId = this.posId;
      this.posIdResolved = true;
      return this.resolvedPosId;
    }

    // Auto-detectar desde la API
    try {
      const cajas = await this.getCajas();
      if (cajas && cajas.length > 0) {
        // Contar qué POS aparece más veces en las sesiones de caja → el más activo
        const freq: Record<string, number> = {};
        for (const c of cajas) {
          if (c.pos) freq[c.pos] = (freq[c.pos] || 0) + 1;
        }
        const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]);
        if (sorted.length > 0) {
          this.resolvedPosId = sorted[0][0];
          console.log(`✅ [${this.source}] POS auto-detectado: ${this.resolvedPosId}`);
        } else {
          // Sin campo pos, usar el id de la primera caja directamente
          this.resolvedPosId = cajas[0].id || "";
          console.warn(`⚠️ [${this.source}] Cajas sin campo 'pos', usando primera caja: ${this.resolvedPosId}`);
        }
      } else {
        console.warn(`⚠️ [${this.source}] No se encontraron cajas en Contífico.`);
      }
    } catch (err) {
      console.error(`❌ [${this.source}] Error al auto-detectar POS ID:`, err);
    }

    this.posIdResolved = true;
    return this.resolvedPosId;
  }

  /**
   * Get Cajas (Cash Registers)
   */
  async getCajas() {
    try {
      const response = await axios.get(`${this.baseUrl}/caja/`, {
        headers: { Authorization: this.apiKey }
      });
      return response.data;
    } catch (error: any) {
      console.error("❌ Error fetching Cajas:", error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get Bank Accounts (Cuentas Bancarias)
   */
  async getBankAccounts() {
    try {
      // Endpoint: /banco/cuenta/
      const response = await axios.get(`${this.baseUrl}/banco/cuenta/`, {
        headers: { Authorization: this.apiKey }
      });
      return response.data;
    } catch (error: any) {
      console.warn("⚠️ Error fetching Bank Accounts (trying /banco/cuenta/):", error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Send document to SRI for authorization
   * @param documentId Document ID
   */
  async sendToSri(documentId: string) {
    try {
      // PUT /documento/<ID>/sri/ - No body required
      const response = await axios.put(`${this.baseUrl}/documento/${documentId}/sri/`, {}, {
        headers: { Authorization: this.apiKey }
      });
      return response.data;
    } catch (error: any) {
      console.warn("⚠️ Error triggering SRI authorization:", error.response?.data || error.message);
      // We don't throw here because the invoice is already created and valid, just not authorized yet.
      // Contifico auto-script might pick it up later.
      return { error: error.response?.data || error.message };
    }
  }

  /**
   * Get SRI authorization status for an electronic document
   * @param documentId The Contífico Document ID
   */
  async getDocumentEstado(documentId: string) {
    try {
      const response = await axios.get(`${this.baseUrl}/documento/${documentId}/estado/`, {
        headers: { Authorization: this.apiKey }
      });
      return response.data; // { documento_id, tipo_registro, tipo_documento, estado }
    } catch (error: any) {
      console.error("❌ Error fetching document estado:", error.response?.data || error.message);
      throw new Error(error.response?.data?.mensaje || "Failed to fetch document estado");
    }
  }

  /**
   * Get stock per warehouse for a specific product
   * @param productId The Contífico Product ID
   */
  async getStockByProduct(productId: string) {
    try {
      if (!productId) throw new Error("Product ID is required");

      const response = await axios.get(`${this.baseUrl}/producto/${productId}/stock/`, {
        headers: { Authorization: this.apiKey },
      });

      return response.data;
    } catch (error: any) {
      console.error(`❌ Error fetching stock for product ${productId}:`, error.response?.data || error.message);
      return [];
    }
  }

  /**
   * Get warehouses from Contífico
   */
  async getWarehouses() {
    try {
      const response = await axios.get(`${this.baseUrl}/bodega/`, {
        headers: { Authorization: this.apiKey },
      });
      return response.data;
    } catch (error: any) {
      console.error("❌ Error fetching warehouses from Contífico:", error.response?.data || error.message);
      return [];
    }
  }
}
