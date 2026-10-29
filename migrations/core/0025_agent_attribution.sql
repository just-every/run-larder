CREATE TABLE larder_command_agents (
  command_id TEXT PRIMARY KEY REFERENCES larder_commands(id),
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  sponsor_id TEXT NOT NULL,
  sponsor_name TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  approvers TEXT NOT NULL
);
