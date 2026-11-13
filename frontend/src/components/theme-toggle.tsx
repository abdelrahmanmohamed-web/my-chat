import { MoonIcon, SunIcon, SunMoonIcon } from "lucide-react";
import { useTheme } from "next-themes";
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";

export function ThemeSubMenu() {
  const { theme = "system", setTheme } = useTheme();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        {theme === "dark" ? (
          <MoonIcon aria-hidden="true" />
        ) : theme === "light" ? (
          <SunIcon aria-hidden="true" />
        ) : (
          <SunMoonIcon aria-hidden="true" />
        )}
        <span>المظهر</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">فاتح</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">داكن</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">تلقائي</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
