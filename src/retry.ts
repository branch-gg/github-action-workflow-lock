export default async function retry<T>(
  fn: () => Promise<T>,
  retries: number = 5,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < retries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.error(`Attempt ${attempt + 1} failed:`, error);
      attempt++;
    }
  }

  throw lastError;
}
