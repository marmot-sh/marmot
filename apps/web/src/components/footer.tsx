import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

import { Logo } from "@/components/logo";

const linkClassName =
  "text-muted-foreground transition-colors hover:text-foreground";

type FooterLinkProps =
  | { to: "/docs/$"; splat: string; children: ReactNode }
  | { to: "/providers"; children: ReactNode }
  | { href: string; children: ReactNode };

function FooterLink(props: FooterLinkProps) {
  if ("href" in props) {
    return (
      <a href={props.href} className={linkClassName}>
        {props.children}
      </a>
    );
  }
  if (props.to === "/docs/$") {
    return (
      <Link
        to="/docs/$"
        params={{ _splat: props.splat }}
        className={linkClassName}
      >
        {props.children}
      </Link>
    );
  }
  return (
    <Link to={props.to} className={linkClassName}>
      {props.children}
    </Link>
  );
}

export function Footer() {
  return (
    <footer className="bg-muted">
      <div className="container mx-auto flex flex-col items-start gap-6 px-6 py-10 sm:flex-row sm:items-center sm:justify-between sm:py-12">
        <Logo />
        <nav
          aria-label="Footer"
          className="flex flex-wrap items-center gap-x-7 gap-y-2 text-[13px]"
        >
          <FooterLink to="/docs/$" splat="">
            Docs
          </FooterLink>
          <FooterLink to="/docs/$" splat="quickstart">
            Quick start
          </FooterLink>
          <FooterLink to="/docs/$" splat="installation">
            Installation
          </FooterLink>
          <FooterLink to="/providers">Providers</FooterLink>
          <FooterLink href="https://github.com/marmot-sh/marmot">
            GitHub
          </FooterLink>
          <FooterLink href="https://x.com/marmot_sh">X</FooterLink>
        </nav>
      </div>
    </footer>
  );
}
