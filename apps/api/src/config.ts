function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  botToken: () => required("BOT_TOKEN"),
  startAppSecret: () => required("STARTAPP_SECRET"),
  host: () => process.env.API_HOST ?? "0.0.0.0",
  port: () => Number(process.env.API_PORT ?? 3000),
  initDataMaxAge: () =>
    Number(process.env.INITDATA_MAX_AGE_SECONDS ?? 86_400),
  publicApiUrl: () => process.env.PUBLIC_API_URL ?? "http://localhost:3000",
};
