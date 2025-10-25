import type { FrontendSDK } from "@/types";
import type { Filter } from "@caido/sdk-frontend/src/types/filters";

// HTTPQL manager class for handling filter operations
export class HTTPQLManager {
  private sdk: FrontendSDK;

  constructor(sdk: FrontendSDK) {
    this.sdk = sdk;
  }

  // Create a new filter with sample HTTPQL syntax
  async createAuthifyFilter(): Promise<Filter | null> {
    try {
      const filter = await this.sdk.filters.create({
        name: "Custom Authify filter",
        alias: "authify_filter",
        query: ''
      });

      // Store the filter data in backend
      await this.sdk.backend.storeHttpqlFilter({
        name: filter.name,
        alias: filter.alias,
        query: filter.query
      });

      console.log("Authify filter created successfully:", filter);
      return filter;
    } catch (error) {
      console.error("Error creating Authify filter:", error);
      return null;
    }
  }

  // Get the filter called "Authify"
  async getAuthifyFilter(): Promise<Filter | null> {
    try {
      const allFilters = this.sdk.filters.getAll();
      const authifyFilter = allFilters.find(filter => filter.alias === "authify_filter");
      
      if (authifyFilter) {
        console.log("Retrieved Authify filter successfully:", authifyFilter);
        return authifyFilter;
      } else {
        console.log("Authify filter not found");
        return null;
      }
    } catch (error) {
      console.error("Error retrieving Authify filter:", error);
      return null;
    }
  }

  // Get all filters
  getAllFilters(): Filter[] {
    try {
      return this.sdk.filters.getAll();
    } catch (error) {
      console.error("Error getting all filters:", error);
      return [];
    }
  }

  // Delete a filter by ID
  async deleteFilter(filterId: string): Promise<boolean> {
    try {
      await this.sdk.filters.delete(filterId);
      console.log(`Filter with ID ${filterId} deleted successfully`);
      return true;
    } catch (error) {
      console.error(`Error deleting filter with ID ${filterId}:`, error);
      return false;
    }
  }

  // Update a filter
  async updateFilter(filterId: string, options: {
    name: string;
    alias: string;
    query: string;
  }): Promise<Filter | null> {
    try {
      const updatedFilter = await this.sdk.filters.update(filterId, options);
      console.log("Filter updated successfully:", updatedFilter);
      return updatedFilter;
    } catch (error) {
      console.error("Error updating filter:", error);
      return null;
    }
  }

  // Sync filter with backend storage
  async syncFilterWithBackend(): Promise<void> {
    try {
      const authifyFilter = await this.getAuthifyFilter();
      if (authifyFilter) {
        // Store the current filter data in backend
        await this.sdk.backend.storeHttpqlFilter({
          name: authifyFilter.name,
          alias: authifyFilter.alias,
          query: authifyFilter.query
        });
        console.log("Filter synced with backend successfully");
      } else {
        // Store null when filter doesn't return properly
        await this.sdk.backend.storeHttpqlFilter(null);
        console.log("Filter not found, stored null in backend");
      }
    } catch (error) {
      console.error("Error syncing filter with backend:", error);
      // Store null on error as well
      try {
        await this.sdk.backend.storeHttpqlFilter(null);
        console.log("Error occurred, stored null in backend");
      } catch (storeError) {
        console.error("Error storing null in backend:", storeError);
      }
    }
  }
}
