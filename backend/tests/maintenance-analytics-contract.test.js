const fs=require('node:fs'),path=require('node:path'),yaml=require('js-yaml');
const api=yaml.safeLoad(fs.readFileSync(path.join(__dirname,'../openapi.yaml'),'utf8'));
const examples=require('../examples/maintenance-analytics-responses.json');
const dictionary=require('../examples/maintenance-analytics-definitions.json');
const policy=require('../src/services/maintenance-analytics-policy');
test('published dictionary matches served version and explicit cohort/grain definitions',()=>{
  expect(dictionary.metric_definition_version).toBe(policy.version);
  expect(dictionary.definitions).toEqual(policy.definitions);
  expect(dictionary.definitions.find(d=>d.metric_key==='rework_decision_rate').grain).toBe('DECISION');
  expect(dictionary.definitions.find(d=>d.metric_key==='active_execution_time').grain).toBe('ATTEMPT');
});
test('five read-only endpoint contracts expose no arbitrary status filter and examples follow bounded DTO fields',()=>{
  for(const endpoint of ['overview','trends','machines','drilldown','definitions']){
    const route=api.paths['/maintenance-analytics/'+endpoint];
    expect(Object.keys(route)).toEqual(['get']);
    expect(route.get.parameters.map(p=>p.name)).not.toContain('status');
    expect(route.get.responses['503']).toBeDefined();
  }
  for(const example of Object.values(examples)){
    expect(Object.keys(example).sort()).toEqual(['data','meta','success']);
    expect(Object.keys(example.meta).sort()).toEqual(api.components.schemas.MaintenanceAnalyticsMeta.required.slice().sort());
    expect(example.meta.metric_definition_version).toBe(policy.version);
  }
  for(const row of examples.drilldown.data.items)
    expect(Object.keys(row).sort()).toEqual(api.components.schemas.MaintenanceAnalyticsSample.required.slice().sort());
  expect(JSON.stringify(examples)).not.toContain('PRIVATE');
  for(const field of ['report','payload_json','verification','work_performed','requirements_json'])
    expect(api.components.schemas.MaintenanceAnalyticsSample.properties).not.toHaveProperty(field);
});
