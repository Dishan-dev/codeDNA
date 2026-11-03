/** Open the advanced developer tools (mode tabs) through the header menu. */
export async function openAdvanced(page) {
  await page.getByRole('button', { name: 'Advanced tools', exact: true }).click();
  await page.getByRole('menuitem', { name: /Discover modules/ }).click();
  await page.getByRole('tab', { name: 'Discover' }).waitFor();
}
