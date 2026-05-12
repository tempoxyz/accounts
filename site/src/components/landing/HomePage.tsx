import "../landing.css";
import Customize from "./customize";
import Demo from "./demo/Demo";
import Guides from "./guides";
import Hero, { DemoSplit } from "./hero";

export default function HomePage() {
  return (
    <main className="landing-page relative w-full bg-black text-white">
      <div className="dash-y mx-auto w-full max-w-[1245px]">
        <Hero />
        <Demo />
        <div className="dash-t">
          <DemoSplit />
        </div>
        <div className="dash-t">
          <Customize />
        </div>
        <div className="dash-t">
          <Guides />
        </div>
      </div>
    </main>
  );
}
