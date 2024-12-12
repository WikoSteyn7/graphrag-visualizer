self.onmessage = (event) => {
  const data = event.data;
  // Add force calculation logic here
  self.postMessage(data);
}; 