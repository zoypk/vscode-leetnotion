export interface DisposableLike {
    dispose(): void;
}

export interface NodeEventSource {
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
}

export class ActivationResources implements DisposableLike {
    private readonly resources: DisposableLike[] = [];
    private disposed = false;

    public add(...resources: DisposableLike[]): DisposableLike[] {
        if (this.disposed) {
            for (const resource of resources) {
                resource.dispose();
            }
            return resources;
        }
        this.resources.push(...resources);
        return resources;
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const resource of this.resources.splice(0).reverse()) {
            resource.dispose();
        }
    }
}

export function registerActivationResources(register: () => DisposableLike[]): ActivationResources {
    const resources = new ActivationResources();
    resources.add(...register());
    return resources;
}

export function registerNodeEvent(
    source: NodeEventSource,
    event: string,
    listener: (...args: unknown[]) => void,
): DisposableLike {
    source.on(event, listener);
    let disposed = false;
    return {
        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;
            source.removeListener(event, listener);
        },
    };
}
