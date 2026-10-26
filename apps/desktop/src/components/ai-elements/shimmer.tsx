import { memo, useMemo, type ComponentType, type CSSProperties, type ElementType, type JSX } from "react";
import { motion, type MotionProps } from "motion/react";
import { cn } from "@/lib/utils";

type MotionHTMLProps = MotionProps & Record<string, unknown>;

const motionComponentCache = new Map<keyof JSX.IntrinsicElements, ComponentType<MotionHTMLProps>>();

function getMotionComponent(element: keyof JSX.IntrinsicElements) {
  let component = motionComponentCache.get(element);
  if (!component) {
    component = motion.create(element) as ComponentType<MotionHTMLProps>;
    motionComponentCache.set(element, component);
  }
  return component;
}

export type ShimmerProps = {
  children: string;
  as?: ElementType;
  className?: string;
  duration?: number;
  spread?: number;
};

function ShimmerComponent({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2,
}: ShimmerProps) {
  const MotionComponent = getMotionComponent(Component as keyof JSX.IntrinsicElements);
  const dynamicSpread = useMemo(() => children.length * spread, [children, spread]);

  return (
    <MotionComponent
      initial={{ backgroundPosition: "100% center" }}
      animate={{ backgroundPosition: "0% center" }}
      transition={{ duration, ease: "linear", repeat: Number.POSITIVE_INFINITY }}
      className={cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--shimmer:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className,
      )}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          backgroundImage:
            "var(--shimmer), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
        } as CSSProperties
      }
    >
      {children}
    </MotionComponent>
  );
}

export const Shimmer = memo(ShimmerComponent);
