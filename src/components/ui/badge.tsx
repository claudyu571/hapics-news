import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[0.66rem] font-semibold uppercase tracking-[0.12em] leading-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-ink text-paper",
        outline: "border-line bg-transparent text-muted",
        accent: "border-accent/20 bg-accent-soft text-accent",
        warning: "border-amber-700/20 bg-amber-100 text-amber-900",
      },
    },
    defaultVariants: { variant: "outline" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
