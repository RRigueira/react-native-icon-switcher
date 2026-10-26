import * as sync from '../sync';
import { ConfigError } from '../core/errors';
import { TransformError } from '../transforms/errors';
import { ProjectLayoutError } from '../paths';
import { run } from '../cli';

function _stderr(): string {
  return (process.stderr.write as jest.Mock).mock.calls
    .map((call) => String(call[0]))
    .join('');
}

describe('cli run', () => {
  let syncSpy: jest.SpiedFunction<typeof sync.syncProject>;

  beforeEach(() => {
    syncSpy = jest.spyOn(sync, 'syncProject');
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects commands other than sync', async () => {
    const code = await run(['help']);
    expect(code).toBe(2);
    expect(_stderr()).toContain('Usage: react-native-icon-switcher sync');
  });

  it('requires a value after --project-root', async () => {
    const code = await run(['sync', '--project-root']);
    expect(code).toBe(2);
    expect(_stderr()).toContain('--project-root requires a directory');
  });

  it('requires a value after --config', async () => {
    const code = await run(['sync', '--config']);
    expect(code).toBe(2);
    expect(_stderr()).toContain('--config requires a path');
  });

  it('rejects unknown flags', async () => {
    const code = await run(['sync', '--verbose']);
    expect(code).toBe(2);
    expect(_stderr()).toContain('Unknown argument: --verbose');
  });

  it('prints a summary after a successful sync', async () => {
    syncSpy.mockResolvedValue({
      updated: 3,
      unchanged: 7,
      driftedPaths: [],
    });
    const code = await run(['sync', '--project-root', '/tmp/app']);
    expect(code).toBe(0);
    expect(syncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: '/tmp/app',
        check: false,
        configPath: undefined,
      })
    );
    expect(String((process.stdout.write as jest.Mock).mock.calls[0]?.[0])).toBe(
      'updated 3 files, unchanged 7\n'
    );
  });

  it('forwards --check and --config to syncProject', async () => {
    syncSpy.mockResolvedValue({
      updated: 0,
      unchanged: 0,
      driftedPaths: [],
    });
    await run(['sync', '--check', '--config', 'custom.config.ts']);
    expect(syncSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        check: true,
        configPath: 'custom.config.ts',
      })
    );
  });

  it('lists drifted paths and exits 1 in check mode', async () => {
    syncSpy.mockResolvedValue({
      updated: 0,
      unchanged: 0,
      driftedPaths: ['b/a.xml', 'a/z.png'],
    });
    const code = await run(['sync', '--check']);
    expect(code).toBe(1);
    expect(_stderr()).toContain('a/z.png');
    expect(_stderr()).toContain('b/a.xml');
  });

  it('maps ConfigError to exit code 2', async () => {
    syncSpy.mockRejectedValue(new ConfigError('bad config'));
    const code = await run(['sync']);
    expect(code).toBe(2);
    expect(_stderr()).toContain('bad config');
  });

  it('maps TransformError and ProjectLayoutError to exit code 2', async () => {
    syncSpy.mockRejectedValue(new TransformError('bad manifest'));
    expect(await run(['sync'])).toBe(2);

    syncSpy.mockRejectedValue(new ProjectLayoutError('no ios'));
    expect(await run(['sync'])).toBe(2);
  });

  it('rethrows unexpected errors', async () => {
    syncSpy.mockRejectedValue(new Error('disk full'));
    await expect(run(['sync'])).rejects.toThrow('disk full');
  });
});
