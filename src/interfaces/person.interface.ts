export interface IPerson {
  id?: string;
  razon_social: string;
  ruc: string; // Used for both RUC and Cedula in our internal logic before mapping
  cedula?: string;
  email: string;
  direccion: string;
  telefonos: string;
  tipo?: "N" | "J" | "I" | "P"; // Natural, Juridica, Sin ID, Placa
  es_cliente?: boolean;
  es_proveedor?: boolean;
  es_empleado?: boolean;
  es_vendedor?: boolean;
  es_extranjero?: boolean;
  nombre_comercial?: string;
}
