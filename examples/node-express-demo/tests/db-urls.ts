// Local throwaway database started by global-setup.ts. Not real credentials.
export const PG_PORT = 54329;
export const OWNER_URL = `postgres://postgres:postgres@localhost:${PG_PORT}/demo`;
export const APP_URL = `postgres://app_user:app_user_local@localhost:${PG_PORT}/demo`;
export const ORIGIN = "http://localhost:5173";
