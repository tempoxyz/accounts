"use client";

import { useRef } from "react";
import Customize from "./customize";
import Demo from "./demo/Demo";
import Footer from "./footer";
import Guides from "./guides";
import Hero from "./hero";
import { ThemeProvider } from "./useTheme";
import "./styles.css";

export default function Home() {
  const rootRef = useRef<HTMLElement>(null);
  return (
    <main ref={rootRef} className="accounts-landing relative w-full">
      <ThemeProvider target={rootRef}>
        <div className="mx-auto w-full max-w-[1245px]">
          <Hero>
            <Demo />
          </Hero>
          <Customize />
          <Guides />
          <div className="dash-t">
            <Footer />
          </div>
        </div>
      </ThemeProvider>
    </main>
  );
}
