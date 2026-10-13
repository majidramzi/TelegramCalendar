function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export const config = {
  botToken: () => required("BOT_TOKEN"),
  botUsername: () => required("BOT_USERNAME"),
  miniAppShortName: () => process.env.MINIAPP_SHORT_NAME ?? "calendar",
  startAppSecret: () => required("STARTAPP_SECRET"),
  redisUrl: () => process.env.REDIS_URL ?? "redis://localhost:6379",
  botMode: () => (process.env.BOT_MODE === "webhook" ? "webhook" : "polling") as
    | "polling"
    | "webhook",
  webhookUrl: () => process.env.WEBHOOK_URL ?? "",
  webhookSecret: () => process.env.WEBHOOK_SECRET ?? "",
  publicApiUrl: () => process.env.PUBLIC_API_URL ?? "http://localhost:3000",
};
