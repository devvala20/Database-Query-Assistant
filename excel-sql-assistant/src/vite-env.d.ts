/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MOCK_AI?: string;
  readonly VITE_PROXY_URL?: string;
  readonly VITE_PROXY_AUTH_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
