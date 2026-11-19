from pathlib import Path
p=Path(__file__).parent
prefix=(p/'public-contract.test.tsx').read_text().split('it("01 ')[0]
cases='''
it("control: unchanged employee and role accepts its current queued read", async () => {
  seam.read.mockResolvedValueOnce(result("WIDE")); render(page()); await screen.findByText("WIDE 0");
  const old = deferred<unknown>(); seam.read.mockReturnValueOnce(old.promise);
  fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  fireEvent.click(screen.getByRole("button", {name: "Refresh data"}));
  await waitFor(() => expect(seam.fetch).toHaveBeenCalledTimes(1));
  await act(async () => old.resolve(result("CURRENT")));
  await screen.findByText("CURRENT 0");
  expect(screen.getByLabelText("Display context").textContent).toContain('"role":"admin"');
});
it("control: changed canonical server scope replaces the workspace and refuses the old queued read", async () => {
  seam.read.mockResolvedValueOnce(result("WIDE")); const view = render(page()); await screen.findByText("WIDE 0");
  const old = deferred<unknown>(); seam.read.mockReturnValueOnce(old.promise);
  fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  seam.fetch.mockResolvedValueOnce(contextResponse("replacement-reader", "employee"));
  fireEvent.click(screen.getByRole("button", {name: "Refresh data"}));
  await waitFor(() => expect(seam.fetch).toHaveBeenCalledTimes(1));
  seam.read.mockResolvedValueOnce({status: "forbidden"}); view.rerender(page({scope: "managed"}));
  await screen.findByText(/Period submissions are unavailable/);
  await act(async () => old.resolve(result("LATE WIDE")));
  expect(screen.queryByText("LATE WIDE 0")).toBeNull();
  expect(screen.queryByRole("link", {name: "Open the approval inbox"})).toBeNull();
});
it("blocker: changed employee and role from actual provider still accepts wider queued success", async () => {
  seam.read.mockResolvedValueOnce(result("WIDE")); render(page()); await screen.findByText("WIDE 0");
  const old = deferred<unknown>(); seam.read.mockReturnValueOnce(old.promise);
  fireEvent.click(screen.getByRole("button", {name: "Refresh submissions"}));
  seam.fetch.mockResolvedValueOnce(contextResponse("replacement-reader", "employee"));
  fireEvent.click(screen.getByRole("button", {name: "Refresh data"}));
  await waitFor(() => expect(seam.fetch).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByLabelText("Display context").textContent).toContain('"employeeId":"replacement-reader"'));
  const display = screen.getByLabelText("Display context").textContent;
  expect(display).toContain('"employeeId":"replacement-reader"');
  expect(display).toContain('"role":"employee"');
  await act(async () => old.resolve(result("LATE WIDE")));
  const late = screen.queryByText("LATE WIDE 0");
  const message = JSON.stringify({display: JSON.parse(display!), readCalls: seam.read.mock.calls.length, lateWiderRowPresent: Boolean(late), inboxPresent: Boolean(screen.queryByRole("link", {name: "Open the approval inbox"})), allScopeStillVisible: Boolean(screen.queryByText("All covered employees")), sessionUserUnchanged: seam.session.data.user.id === access.userId, sessionOrgUnchanged: seam.session.data.session.activeOrganizationId === access.organizationId});
  expect(late, message).toBeNull();
});
'''
(p/'minimal-arrival.test.tsx').write_text(prefix+cases)
