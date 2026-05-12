import { DemoTile } from "./demo-grid";
import { themeById } from "./themes";

const tileIds = ["doordash", "claude", "linear", "cash", "notion"];

export function DemoStack() {
  return (
    <div className="flex w-full flex-col gap-3">
      {tileIds.map((id, i) => (
        <DemoTile key={id} theme={themeById(id)} index={i} />
      ))}
    </div>
  );
}
