export const DEV_TOOLS_ENABLED =
  process.env.NEXT_PUBLIC_DEV_TOOLS === "1" ||
  process.env.NODE_ENV !== "production";
