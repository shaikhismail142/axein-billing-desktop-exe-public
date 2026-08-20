export function isSaasDeployment(): boolean {
  return process.env.AXEIN_DEPLOYMENT_MODE === "saas";
}

export function isDesktopDeployment(): boolean {
  return !isSaasDeployment();
}

export function requireSaasSecret(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required in SaaS mode`);
  return value;
}
