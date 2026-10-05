export function handleBriefRequest(request: Request, options: { after: (callback: () => void | Promise<void>) => void }): Promise<Response>;
