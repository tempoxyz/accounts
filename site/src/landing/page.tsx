"use client";

import Customize from "./customize";
import Demo from "./demo/Demo";
import Footer from "./footer";
import Guides from "./guides";
import Hero from "./hero";
import { ThemeProvider } from "./useTheme";

export default function Home() {
  return (
    <main className="accounts-landing relative w-full">
      <ThemeProvider>
        <div className="mx-auto w-full max-w-[1245px]">
          <Hero>
            <Demo />
          </Hero>
          <Customize />
          <Guides />
          <Footer />
        </div>
      </ThemeProvider>
    </main>
  );
}
