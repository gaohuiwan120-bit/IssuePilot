# MLPilot Demo

## 1. Install
cd agent-projects/mlpilot
npm install --ignore-scripts && npm run build

## 2. Configure PyTorch project
cp agent-projects/mlpilot/.pi/settings.json.example your-project/.pi/settings.json

## 3. Run Pi
cd your-project
node ../pi-upstream/packages/coding-agent/dist/cli.js

## 4. Workflow commands
/mlpilot-advance
/skill:pytorch-error-diagnosis
inspect_ml_project
/mlpilot-approve
/mlpilot-checkpoint
/mlpilot-advance
run_test_suite
generate_validation_report