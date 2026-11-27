import { useState, type ComponentProps } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type"> & {
  fieldLabel?: string;
};

export function PasswordInput({
  className,
  dir = "rtl",
  fieldLabel = "كلمة المرور",
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        dir={dir}
        type={visible ? "text" : "password"}
        className={cn("pe-10 text-start", className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setVisible((prev) => !prev)}
        aria-label={visible ? `إخفاء ${fieldLabel}` : `إظهار ${fieldLabel}`}
        aria-pressed={visible}
        className="absolute inset-y-0.5 end-1 text-muted-foreground hover:text-foreground"
      >
        {visible ? (
          <EyeOffIcon className="size-4" aria-hidden="true" />
        ) : (
          <EyeIcon className="size-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}
