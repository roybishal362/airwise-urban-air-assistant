/** Raised when upstream data is present but unusable (e.g. every pollutant is null). */
export class InsufficientDataError extends Error {
  override readonly name = 'InsufficientDataError';
}
