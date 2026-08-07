"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { forwardRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DUR, EASE_OUT_EXPO } from "@/lib/motion/variants";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

type BaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Renders full-width. Common on mobile sheets. */
  block?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/* Built on HTMLMotionProps rather than the raw DOM props: motion overloads
   onDrag/onAnimationStart with its own gesture signatures, and mixing the two
   produces an unassignable intersection. */
type ButtonProps = BaseProps & Omit<HTMLMotionProps<"button">, keyof BaseProps>;

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-on-accent border border-transparent hover:bg-accent-strong",
  secondary:
    "bg-surface-2 text-fg border border-line-strong hover:border-fg-subtle hover:bg-surface-3",
  ghost:
    "bg-transparent text-fg-muted border border-transparent hover:text-fg hover:bg-surface-3",
  danger:
    "bg-transparent text-caution border border-caution/40 hover:bg-caution-soft",
};

/* Sizes keep a 44px minimum height at md/lg. `sm` is only for dense
   desktop toolbars and pairs with the `tap` utility where it goes mobile. */
const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3.5 text-body-sm gap-1.5 rounded-lg",
  md: "min-h-11 px-5 py-2.5 text-body gap-2 rounded-full",
  lg: "min-h-13 px-7 py-3.5 text-body-lg gap-2.5 rounded-full",
};

/** Two-arc spinner. Sized in `em` so it tracks the button's own type size. */
function Spinner({ label = "Working" }: { label?: string }) {
  return (
    <span
      role="status"
      aria-label={label}
      className="inline-block h-[1em] w-[1em] shrink-0 animate-spin rounded-full border-[1.5px] border-current border-r-transparent border-t-transparent motion-reduce:animate-none"
    />
  );
}

/**
 * Tactile button. The press state is a real scale transform rather than a
 * colour swap, because on touch the colour change is hidden under the finger.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    block = false,
    iconLeft,
    iconRight,
    children,
    className,
    disabled,
    type = "button",
    ...rest
  },
  ref,
) {
  const reduce = useReducedMotion();
  const isDisabled = disabled || loading;

  return (
    <motion.button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      whileHover={reduce || isDisabled ? undefined : { y: -1 }}
      whileTap={reduce || isDisabled ? undefined : { scale: 0.975, y: 0 }}
      transition={{ duration: DUR.tap, ease: EASE_OUT_EXPO }}
      className={cn(
        "relative inline-flex select-none items-center justify-center font-medium",
        "transition-colors duration-200 ease-[var(--ease-out-expo)]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        "disabled:cursor-not-allowed disabled:opacity-45",
        SIZES[size],
        VARIANTS[variant],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : iconLeft}
      {children ? (
        <span className={cn(loading && "opacity-80")}>{children}</span>
      ) : null}
      {!loading && iconRight}
    </motion.button>
  );
});

type LinkButtonProps = BaseProps & Omit<HTMLMotionProps<"a">, keyof BaseProps>;

/** Same skin, anchor semantics. For navigation, not actions. */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(
  function LinkButton(
    {
      variant = "primary",
      size = "md",
      block = false,
      iconLeft,
      iconRight,
      children,
      className,
      ...rest
    },
    ref,
  ) {
    const reduce = useReducedMotion();

    return (
      <motion.a
        ref={ref}
        whileHover={reduce ? undefined : { y: -1 }}
        whileTap={reduce ? undefined : { scale: 0.975, y: 0 }}
        transition={{ duration: DUR.tap, ease: EASE_OUT_EXPO }}
        className={cn(
          "relative inline-flex select-none items-center justify-center font-medium no-underline",
          "transition-colors duration-200 ease-[var(--ease-out-expo)]",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          SIZES[size],
          VARIANTS[variant],
          block && "w-full",
          className,
        )}
        {...rest}
      >
        {iconLeft}
        {children ? <span>{children}</span> : null}
        {iconRight}
      </motion.a>
    );
  },
);
