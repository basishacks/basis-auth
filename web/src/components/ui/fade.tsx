import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface FadeProps {
    show: boolean;
    duration?: number;
    className?: string;
    children: ReactNode;
}

/**
 * Vue <Transition>-style fade: keeps children mounted while `show` is false
 * until the opacity transition has finished, then unmounts them.
 */
export function Fade({ show, duration = 300, className, children }: FadeProps) {
    const [mounted, setMounted] = useState(show);
    const [visible, setVisible] = useState(show);

    useEffect(() => {
        if (show) {
            setMounted(true);
            // Double rAF so the browser paints opacity-0 before flipping to
            // opacity-100, otherwise the enter transition is skipped.
            const frame = requestAnimationFrame(() =>
                requestAnimationFrame(() => setVisible(true))
            );
            return () => cancelAnimationFrame(frame);
        }
        setVisible(false);
        const timeout = setTimeout(() => setMounted(false), duration);
        return () => clearTimeout(timeout);
    }, [show, duration]);

    if (!mounted) return null;

    return (
        <div
            className={cn(
                "transition-opacity",
                visible ? "opacity-100" : "pointer-events-none opacity-0",
                className
            )}
            style={{ transitionDuration: `${duration}ms` }}
        >
            {children}
        </div>
    );
}
