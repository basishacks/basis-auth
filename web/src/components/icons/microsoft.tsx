import type { SVGProps } from "react";

export function MicrosoftLogo(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 23 23" aria-hidden="true" {...props}>
            <rect x="1" y="1" width="10" height="10" fill="#F25022" />
            <rect x="12" y="1" width="10" height="10" fill="#7FBA00" />
            <rect x="1" y="12" width="10" height="10" fill="#00A4EF" />
            <rect x="12" y="12" width="10" height="10" fill="#FFB900" />
        </svg>
    );
}
