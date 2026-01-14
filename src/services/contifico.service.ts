import axios from "axios";

export class ContificoService {
  private apiKey: string;
  private token: string;
  private baseUrl: string = "https://api.contifico.com/sistema/api/v1";

  constructor() {
    this.apiKey = process.env.CONTIFICO_API_KEY || "";
    this.token = process.env.CONTIFICO_TOKEN || "";

    if (!this.apiKey || !this.token) {
      console.warn("⚠️ Contífico credentials missing in .env");
    }
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
        const totalLine = cantidad * precio;

        // Assume 15% IVA for now. In a real app, this should come from product DB.
        // If product has IVA:
        const hasIva = true; // Defaulting to true for now based on test product
        const porcentaje_iva = hasIva ? 15 : 0;

        let base_cero = 0;
        let base_gravable = 0;
        let base_no_gravable = 0;
        let iva_line = 0;

        if (porcentaje_iva > 0) {
          base_gravable = totalLine;
          iva_line = Number((base_gravable * (porcentaje_iva / 100)).toFixed(2));
          subtotal_15 += base_gravable;
          total_iva += iva_line;
        } else {
          base_cero = totalLine;
          subtotal_0 += base_cero;
        }

        return {
          producto_id: p.contifico_id || "9pgenB6GQcVWoeNQ", // Fallback to test product if missing, but should be mapped
          cantidad: cantidad,
          precio: precio,
          descripcion: p.name,
          porcentaje_iva: porcentaje_iva,
          base_cero: base_cero,
          base_gravable: base_gravable,
          base_no_gravable: base_no_gravable,
          descuento: 0
        };
      });

      total_final = subtotal_0 + subtotal_15 + total_iva;

      // 2. Prepare Payload
      // Generating a random document number (sequence) to avoid collisions during dev.
      // IN PROD: You should query the sequence or use auto-generation if supported.
      const randomSeq = Math.floor(Math.random() * 900000) + 100000;
      const docNumber = `001-001-000${randomSeq}`;

      const payload = {
        pos: this.token,
        fecha_emision: new Date().toLocaleDateString("en-GB"), // DD/MM/YYYY
        tipo_documento: "FAC",
        documento: docNumber,
        estado: "P",
        electronico: true,
        autorizacion: "",
        cliente: {
          razon_social: orderData.invoiceData.businessName,
          ruc: orderData.invoiceData.ruc,
          cedula: orderData.invoiceData.ruc.length === 10 ? orderData.invoiceData.ruc : "", // Try to send cedula if ruc is 10 digits (cedula)
          email: orderData.invoiceData.email,
          direccion: orderData.invoiceData.address,
          tipo: "C",
          telefonos: orderData.customerPhone
        },
        detalles: detalles.map((d: any) => ({
          ...d,
          porcentaje_descuento: d.descuento,
          descuento: undefined // Remove old field if needed, or keep if API ignores it. Better to be clean.
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

      console.log("🚀 Sending invoice to Contífico:", JSON.stringify(payload, null, 2));

      const response = await axios.post(`${this.baseUrl}/documento/`, payload, {
        headers: {
          Authorization: this.apiKey,
          "Content-Type": "application/json",
        },
      });

      console.log("✅ Contífico response:", response.data);
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
  async getProducts(options: { filtro?: string; codigo_barra?: string; categoria_id?: string } = {}) {
    try {
      const params: any = {};

      if (options.filtro) params.filtro = options.filtro;
      if (options.codigo_barra) params.codigo_barra = options.codigo_barra;
      if (options.categoria_id) params.categoria_id = options.categoria_id;

      console.log("🔍 Fetching products from Contífico with params:", params);

      const response = await axios.get(`${this.baseUrl}/producto/`, {
        headers: {
          Authorization: this.apiKey,
        },
        params,
      });

      return response.data;
    } catch (error: any) {
      console.error("❌ Error fetching products from Contífico:", error.response?.data || error.message);
      throw new Error("Failed to fetch products from Contífico");
    }
  }
}
