import type OnyxAz from "./main";

export class PromiseQueue {
    private tasks: {
        task: () => Promise<unknown>;
        onFinished: (res: unknown) => void;
    }[] = [];

    constructor(private readonly plugin: OnyxAz) {}

    addTask<T>(task: () => Promise<T>, onFinished?: (res: T | undefined) => void): void {
        this.tasks.push({ task, onFinished: onFinished ?? (() => {}) });
        if (this.tasks.length === 1) {
            this.handleTask();
        }
    }

    private handleTask(): void {
        if (this.tasks.length > 0) {
            const item = this.tasks[0];
            item.task().then(
                (res) => {
                    item.onFinished(res);
                    this.tasks.shift();
                    this.handleTask();
                },
                (e) => {
                    this.plugin.displayError(e);
                    item.onFinished(undefined);
                    this.tasks.shift();
                    this.handleTask();
                }
            );
        }
    }

    clear(): void {
        this.tasks = [];
    }
}
