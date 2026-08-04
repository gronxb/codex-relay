export async function runConnectionRefresh<Status, Data>(
  statusRequest: Promise<Status>,
  dataRequest: Promise<Data>,
  onStatus: (status: Status) => void,
) {
  const connectedStatus = statusRequest.then((status) => {
    onStatus(status);
    return status;
  });
  const [, data] = await Promise.all([connectedStatus, dataRequest]);
  return data;
}
