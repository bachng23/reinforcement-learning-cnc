// Illustrative presentation metadata. Never passed to the JCST bridge.
const fixture = {
  contextVersion: 'jcst-factory-demo.v1', contextOrigin: 'ILLUSTRATIVE_DEMO',
  factory: { factoryId: 'JCST-DEMO', name: 'JCST demonstration factory' },
  layout: { coordinateUnit: 'SCHEMATIC_GRID', columns: 3, rows: 2 },
  lines: [{ lineId: 'P1', name: 'Pump housing', machineIds: ['M1', 'M2', 'M3'] }],
  machines: [
    ['CNC turning center', 'TURNING', 'Rough turning', 'A', 'A1', 0, 0],
    ['CNC milling center', 'MILLING', 'Precision milling', 'A', 'A2', 1, 0],
    ['CNC finishing center', 'FINISHING', 'Finishing & inspection', 'B', 'B1', 2, 1],
  ].map(([name, type, operation, zone, bay, x, y], simulatorMachineIndex) => ({
    machineId: `M${simulatorMachineIndex + 1}`, simulatorMachineIndex, name, type,
    operation, operationOrder: simulatorMachineIndex + 1, lineId: 'P1',
    location: { zone, bay, x, y },
    assignedBatch: { batchId: 'DEMO-PH-001', productName: 'Pump housing', quantity: null, dueAt: null },
  })),
};
const contextSnapshot = () => structuredClone(fixture);
module.exports = { contextSnapshot };
