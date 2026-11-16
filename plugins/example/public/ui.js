// The page of the plugin. render is called with the element of the page and
// { api, session, ui }: api(method, path) calls the API of the server, ui holds
// the building blocks of the interface (el, button, card, head, notice, ...).
export async function render($page, { api, ui }) {
    const hello = await api('GET', '/plugins/example/hello');
    $page.append(
        ui.head('Example plugin'),
        ui.card('Hello', [
            ['Message', hello.message],
            ['Server', `${hello.server.name} ${hello.server.version}`],
            ['Plugin started', ui.formatDate(hello.startedAt)],
            ['DNS changes since then', String(hello.dnsChanges)],
        ])
    );
}
