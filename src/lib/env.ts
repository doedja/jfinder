import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  // Required APIs
  OPENROUTER_API_KEY: z.string().startsWith('sk-or-', 'Invalid OpenRouter API key format'),

  // Optional: Scopus API (falls back to OpenAlex if not provided)
  SCOPUS_API_KEY: z.string().optional(),
  SCOPUS_API_URL: z.string().url().default('https://api.elsevier.com/content/search/scopus'),

  // Optional configuration
  OPENROUTER_MODEL: z.string().default('meta-llama/llama-3.3-70b-instruct'),

  // Proxy (optional)
  PROXY_URL: z.string().url().optional(),

  // Anna's Archive (optional)
  ANNAS_API_KEY: z.string().optional(),
  RAPIDAPI_KEY: z.string().optional(),

  // Application settings
  DOWNLOAD_DIR: z.string().default('./downloads'),
  MAX_UPLOAD_SIZE: z.coerce.number().default(16 * 1024 * 1024), // 16MB
  TASK_TTL_MS: z.coerce.number().default(60 * 60 * 1000), // 1 hour
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Environment validation failed:');
    result.error.issues.forEach(issue => {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    });
    throw new Error('Invalid environment configuration');
  }

  return result.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
