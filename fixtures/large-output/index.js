// Emit >2KB stdout for artifact spill tests
process.stdout.write("X".repeat(5000));
process.stderr.write("Y".repeat(3000));
