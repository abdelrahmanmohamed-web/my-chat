import { LaptopIcon, SmartphoneIcon } from "lucide-react";

export function SessionDeviceIcon({ device }: { device: string }) {
  const normalized = device.toLowerCase();
  if (
    normalized.includes("iphone") ||
    normalized.includes("android") ||
    normalized.includes("ipad")
  ) {
    return (
      <SmartphoneIcon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    );
  }
  return (
    <LaptopIcon
      className="size-4 shrink-0 text-muted-foreground"
      aria-hidden="true"
    />
  );
}
