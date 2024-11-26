export default async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 5,
  initialDelayMs: number = 150,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Calculate exponential backoff delay
      const delay = initialDelayMs * Math.pow(2, attempt - 1);

      console.error(
        `Attempt ${attempt + 1} failed, waiting ${delay}ms:`,
        error,
      );

      attempt++;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
