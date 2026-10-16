import test from 'node:test';
import assert from 'node:assert/strict';
import { modelConfigurations, validateModelConfig } from '../src/llm.js';

test('model selection is explicit, cloud rates are required, and local mode needs no API key', () => {
  assert.throws(() => validateModelConfig(modelConfigurations.openai), /model required/);
  assert.throws(() => validateModelConfig({ ...modelConfigurations.openai, model: 'test-model' }), /pricing required/);
  assert.doesNotThrow(() => validateModelConfig({ ...modelConfigurations.ollama, model: 'local-test-model' }));
  assert.throws(() => validateModelConfig({ ...modelConfigurations.ollama, model: 'test', maxInputTokens: 0 }));
});
