type SiteOptions = { after?: (task: () => Promise<unknown>) => void };
export function handleSiteRequest(request: Request, options?: SiteOptions): Promise<Response>;
