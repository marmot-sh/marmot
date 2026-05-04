import type { SVGProps } from "react";

/** Hermes-Agent brand mark — solid amber-orange square with a bold black H.
 *  Matches the favicon at https://hermes-agent.org/favicon.ico. Colors are
 *  baked in (hardcoded) so the mark renders the same on light and dark
 *  themes; sized via className just like the other brand logos in this dir. */
export const Hermes = (props: SVGProps<SVGSVGElement>) => (
  <svg {...props} viewBox="0 0 512 512" fill="none">
    <rect width="512" height="512" rx="40" fill="#FFA500" />
    <path
      d="M132 96h74v320h-74zM306 96h74v320h-74zM132 220h248v72H132z"
      fill="#000"
    />
  </svg>
);
