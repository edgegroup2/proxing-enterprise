function mapServiceID(product, network) {
  if (product === "airtime") return network;
  if (product === "data") return `${network}-data`;

  if (product === "tv") return network; 
  if (product === "electricity") return `${network}-electric`;

  if (product === "waec") return "waec";
  if (product === "international-airtime") return "foreign-airtime";

  throw new Error("Unsupported product");
}

module.exports = { mapServiceID };
