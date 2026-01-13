class CustomError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export default CustomError;
