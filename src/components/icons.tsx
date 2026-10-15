import type { SVGProps } from "react";

// Inline icons so that no status is ever communicated by colour alone. Decorative: hidden from
// assistive tech, the adjacent text carries the meaning.
function Icon({ children, className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className ?? ""}`.trim()}
      {...props}
    >
      {children}
    </svg>
  );
}

export const ClockIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M10 5.5V10l3 2" />
  </Icon>
);
export const XCircleIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" />
  </Icon>
);
export const CheckCircleIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M6.5 10.5l2.5 2.5 4.5-5" />
  </Icon>
);
export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7.5" />
    <path d="M8.5 7l5 3-5 3z" />
  </Icon>
);
export const ScissorsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="5.5" cy="5.5" r="2" />
    <circle cx="5.5" cy="14.5" r="2" />
    <path d="M7 7l9 7M7 13l9-7" />
  </Icon>
);
export const AlertIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M10 3L18 16.5H2z" />
    <path d="M10 8v4M10 14.2v.1" />
  </Icon>
);
export const CircleDashedIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} strokeDasharray="3 3">
    <circle cx="10" cy="10" r="7.5" />
  </Icon>
);
export const RefreshIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M16 6V2.5L13.5 5A7 7 0 1 0 17 11" />
  </Icon>
);
export const UserIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="7" r="3" />
    <path d="M4 17c.8-3 3-4.5 6-4.5s5.2 1.5 6 4.5" />
  </Icon>
);
export const SpinnerIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p} className="motion-safe:animate-spin">
    <path d="M10 2.5a7.5 7.5 0 1 0 7.5 7.5" />
  </Icon>
);
