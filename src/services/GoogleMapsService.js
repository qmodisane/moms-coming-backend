const { Client } = require('@googlemaps/google-maps-services-js');
require('dotenv').config();

class GoogleMapsService {
  constructor() {
    this.client = new Client({});
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
  }

  /**
   * Get static satellite image URL for a location
   */
  getStaticMapUrl(center, zoom = 18, size = '600x600') {
    const { lat, lng } = center;
    return `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${size}&maptype=satellite&key=${this.apiKey}`;
  }

  /**
   * Get geocoding info for an address
   */
  async geocode(address) {
    try {
      const response = await this.client.geocode({
        params: {
          address,
          key: this.apiKey
        }
      });
      
      if (response.data.results.length > 0) {
        const result = response.data.results[0];
        return {
          lat: result.geometry.location.lat,
          lng: result.geometry.location.lng,
          formatted_address: result.formatted_address
        };
      }
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  }

  /**
   * Get reverse geocoding (address from coordinates)
   */
  async reverseGeocode(lat, lng) {
    try {
      const response = await this.client.reverseGeocode({
        params: {
          latlng: `${lat},${lng}`,
          key: this.apiKey
        }
      });

      if (response.data.results.length > 0) {
        return response.data.results[0].formatted_address;
      }
      return null;
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      return null;
    }
  }

  /**
   * Calculate distance between two points (in meters)
   */
  calculateDistance(point1, point2) {
    const R = 6371e3; // Earth radius in meters
    const φ1 = point1.lat * Math.PI / 180;
    const φ2 = point2.lat * Math.PI / 180;
    const Δφ = (point2.lat - point1.lat) * Math.PI / 180;
    const Δλ = (point2.lng - point1.lng) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Check if point is inside polygon (boundary checking)
   */
  isPointInBounds(point, boundary) {
    const { lat, lng } = point;
    const polygon = boundary.coordinates;
    
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng, yi = polygon[i].lat;
      const xj = polygon[j].lng, yj = polygon[j].lat;
      
      const intersect = ((yi > lat) !== (yj > lat))
        && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    
    return inside;
  }

  /**
   * Calculate centroid of polygon
   */
  calculateCentroid(coordinates) {
    let latSum = 0;
    let lngSum = 0;
    
    coordinates.forEach(coord => {
      latSum += coord.lat;
      lngSum += coord.lng;
    });
    
    return {
      lat: latSum / coordinates.length,
      lng: lngSum / coordinates.length
    };
  }

  /**
   * Shrink polygon toward center
   */
  shrinkBoundary(boundary, scaleFactor) {
    const centroid = this.calculateCentroid(boundary.coordinates);
    
    const newCoords = boundary.coordinates.map(point => ({
      lat: centroid.lat + (point.lat - centroid.lat) * scaleFactor,
      lng: centroid.lng + (point.lng - centroid.lng) * scaleFactor
    }));
    
    return { coordinates: newCoords };
  }
}

module.exports = new GoogleMapsService();
