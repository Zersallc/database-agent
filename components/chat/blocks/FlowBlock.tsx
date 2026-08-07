"use client";

import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export function FlowBlock({ nodes, edges }: { nodes: Node[]; edges: Edge[] }) {
  return (
    <div className="my-3 h-80 w-full overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  );
}
