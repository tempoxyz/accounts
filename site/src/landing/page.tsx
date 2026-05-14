"use client";

import Customize from "./customize";
import Demo from "./demo/Demo";
import Footer from "./footer";
import Guides from "./guides";
import Hero, { DemoSplit } from "./hero";
import Accounts from "./sections/Accounts";
import LocalPayments from "./sections/LocalPayments";
import SendReceive from "./sections/SendReceive";
import "./styles.css";

export default function Home() {
  return (
    <main className="accounts-landing relative w-full bg-black text-white">
      <div className="dash-y mx-auto w-full max-w-[1245px]">
        <Hero />
        <Demo />
        <div className="dash-t">
          <Accounts />
        </div>
        <div className="dash-t">
          <SendReceive />
        </div>
        <div className="dash-t">
          <LocalPayments />
        </div>
        <div className="dash-t">
          <DemoSplit />
        </div>
        <div className="dash-t">
          <Customize />
        </div>
        <div className="dash-t">
          <Guides />
        </div>
        <div className="dash-t">
          <Footer />
        </div>
      </div>
    </main>
  );
}
