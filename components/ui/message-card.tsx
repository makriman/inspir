import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

function MessageCardGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-card-group"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  );
}

const messageCardVariants = cva(
  "group/card relative flex w-fit max-w-[80%] min-w-0 flex-col gap-1 group-data-[align=end]/message:self-end data-[align=end]:self-end data-[variant=ghost]:max-w-full",
  {
    variants: {
      variant: {
        default:
          "*:data-[slot=message-card-content]:bg-primary *:data-[slot=message-card-content]:text-primary-foreground [&>[data-slot=message-card-content]:is(button,a):hover]:bg-primary/80",
        secondary:
          "*:data-[slot=message-card-content]:bg-secondary *:data-[slot=message-card-content]:text-secondary-foreground [&>[data-slot=message-card-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)]",
        muted:
          "*:data-[slot=message-card-content]:bg-muted [&>[data-slot=message-card-content]:is(button,a):hover]:bg-[color-mix(in_oklch,var(--muted),var(--foreground)_5%)]",
        tinted:
          "*:data-[slot=message-card-content]:bg-[oklch(from_var(--primary)_0.93_calc(c*0.4)_h)] *:data-[slot=message-card-content]:text-foreground dark:*:data-[slot=message-card-content]:bg-[oklch(from_var(--primary)_0.3_calc(c*0.4)_h)] [&>[data-slot=message-card-content]:is(button,a):hover]:bg-[oklch(from_var(--primary)_0.88_calc(c*0.5)_h)] dark:[&>[data-slot=message-card-content]:is(button,a):hover]:bg-[oklch(from_var(--primary)_0.35_calc(c*0.5)_h)]",
        outline:
          "*:data-[slot=message-card-content]:border-border *:data-[slot=message-card-content]:bg-background [&>[data-slot=message-card-content]:is(button,a):hover]:bg-muted [&>[data-slot=message-card-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=message-card-content]:is(button,a):hover]:bg-input/30",
        ghost:
          "border-none *:data-[slot=message-card-content]:rounded-none *:data-[slot=message-card-content]:bg-transparent *:data-[slot=message-card-content]:p-0 [&>[data-slot=message-card-content]:is(button,a):hover]:bg-muted [&>[data-slot=message-card-content]:is(button,a):hover]:text-foreground dark:[&>[data-slot=message-card-content]:is(button,a):hover]:bg-muted/50",
        destructive:
          "*:data-[slot=message-card-content]:bg-destructive/10 *:data-[slot=message-card-content]:text-destructive dark:*:data-[slot=message-card-content]:bg-destructive/20 [&>[data-slot=message-card-content]:is(button,a):hover]:bg-destructive/20 dark:[&>[data-slot=message-card-content]:is(button,a):hover]:bg-destructive/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function MessageCard({
  variant = "default",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof messageCardVariants> & {
    align?: "start" | "end";
  }) {
  return (
    <div
      data-slot="message-card"
      data-variant={variant}
      data-align={align}
      className={cn(messageCardVariants({ variant }), className)}
      {...props}
    />
  );
}

function MessageCardContent({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "div";

  return (
    <Comp
      data-slot="message-card-content"
      className={cn(
        "w-fit max-w-full min-w-0 overflow-hidden rounded-xl border border-transparent px-3 py-2 text-sm leading-relaxed wrap-break-word group-data-[align=end]/card:self-end [button]:text-left [button,a]:transition-colors [button,a]:outline-none [button,a]:focus-visible:border-ring [button,a]:focus-visible:ring-3 [button,a]:focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}

const messageCardReactionsVariants = cva(
  "absolute z-10 flex w-fit shrink-0 items-center justify-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-sm ring-3 ring-card has-[button]:p-0",
  {
    variants: {
      side: {
        top: "top-0 -translate-y-3/4",
        bottom: "bottom-0 translate-y-3/4",
      },
      align: {
        start: "left-3",
        end: "right-3",
      },
    },
    defaultVariants: {
      side: "bottom",
      align: "end",
    },
  },
);

function MessageCardReactions({
  side = "bottom",
  align = "end",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  align?: "start" | "end";
  side?: "top" | "bottom";
}) {
  return (
    <div
      data-slot="message-card-reactions"
      data-align={align}
      data-side={side}
      className={cn(messageCardReactionsVariants({ side, align }), className)}
      {...props}
    />
  );
}

export { MessageCardGroup, MessageCard, MessageCardContent, MessageCardReactions };
