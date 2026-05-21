"use client";

import { useRef } from "react";
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
        <div className="dash-y mx-auto w-full max-w-[1245px]">
          <Hero>
            <Demo />
          </Hero>
          <div className="dash-t">
            <Guides />
          </div>
          <div className="dash-t">
            <Footer />
          </div>
        </div>
      </ThemeProvider>
    </main>
  );
}
