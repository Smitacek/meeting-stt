import { useState, useEffect } from 'react';
import { AppSidebar } from "@/components/app-sidebar"

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { ThemeProvider } from "@/components/theme-provider"
import { ModeToggle } from '@/components/mode-toggle'

import { Footer } from '@/components/Footer'

import { Card, CardHeader, CardContent, CardFooter, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { 
  History as HistoryIcon, 
  Eye, 
  EyeOff, 
  Search, 
  RefreshCw, 
  FileAudio,
  User,
  Monitor,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Filter
} from 'lucide-react'

import { History } from '@/types/history'
import { HistoryAPI } from '@/api/history'
import { HistoryDetailModal } from '@/components/HistoryDetailModal'

// Simple Badge component
interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'secondary' | 'outline';
  className?: string;
}

const Badge = ({ children, variant = 'default', className = '' }: BadgeProps) => {
  const baseClasses = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold';
  const variantClasses = {
    default: 'bg-primary text-primary-foreground',
    secondary: 'bg-secondary text-secondary-foreground',
    outline: 'border border-input bg-background text-foreground'
  };
  
  return (
    <span className={`${baseClasses} ${variantClasses[variant]} ${className}`}>
      {children}
    </span>
  );
};

export default function HistoryPage() {
  const [histories, setHistories] = useState<History[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  
  // Filters and pagination
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVisible, setFilterVisible] = useState<string>('all');
  const [filterType, setFilterType] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  useEffect(() => {
    fetchHistories();
  }, []);

  const fetchHistories = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await HistoryAPI.getAllHistory(false, 1000); // Get all records for client-side filtering
      setHistories(response.histories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch histories');
    } finally {
      setLoading(false);
    }
  };

  const handleViewDetails = (historyId: string) => {
    setSelectedHistoryId(historyId);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedHistoryId(null);
  };

  const toggleVisibility = async (historyId: string, currentVisible: boolean) => {
    try {
      await HistoryAPI.toggleHistoryVisibility(historyId, !currentVisible);
      // Update local state
      setHistories(histories.map(h => 
        h.id === historyId ? { ...h, visible: !currentVisible } : h
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle visibility');
    }
  };

  // Filtering logic
  const filteredHistories = histories.filter(history => {
    const matchesSearch = searchTerm === '' || 
      history.user_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      history.session_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
      history.type.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesVisible = filterVisible === 'all' || 
      (filterVisible === 'visible' && history.visible) ||
      (filterVisible === 'hidden' && !history.visible);
    
    const matchesType = filterType === 'all' || history.type === filterType;
    
    return matchesSearch && matchesVisible && matchesType;
  });

  // Pagination
  const totalPages = Math.ceil(filteredHistories.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedHistories = filteredHistories.slice(startIndex, startIndex + itemsPerPage);

  const getStatusIcon = (history: History) => {
    const completedCount = history.transcriptions.filter(t => t.status === 'completed').length;
    const failedCount = history.transcriptions.filter(t => t.status === 'failed').length;
    const pendingCount = history.transcriptions.filter(t => t.status === 'pending').length;
    
    if (failedCount > 0) {
      return <XCircle className="h-4 w-4 text-red-500" />;
    } else if (pendingCount > 0) {
      return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    } else if (completedCount > 0) {
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
    return <AlertCircle className="h-4 w-4 text-gray-500" />;
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  return (
    <ThemeProvider defaultTheme="light" storageKey="vite-ui-theme">
      <SidebarProvider defaultOpen={true}>
        <AppSidebar />
        <SidebarInset>
          <header className="flex sticky top-0 bg-background h-10 shrink-0 items-center gap-2 border-b px-4 z-10 shadow">
            <div className="flex items-center gap-2 px-4 w-full">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink href="#">
                      App
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator className="hidden md:block" />
                  <BreadcrumbItem>
                    <BreadcrumbPage>History</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <div className="ml-auto hidden items-center gap-2 md:flex">
                <ModeToggle />
              </div>
            </div>
          </header>
          
          {/* Main content */}
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <div className="min-h-[100vh] flex-1 rounded-xl bg-muted/50 md:min-h-min">
              <Separator className="mb-4" />
              
              {/* Header */}
              <Card className="mb-4">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <HistoryIcon className="h-6 w-6" />
                      <CardTitle>Transcription History</CardTitle>
                    </div>
                    <Button onClick={fetchHistories} disabled={loading} variant="outline">
                      <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                
                {/* Filters */}
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="search">Search</Label>
                      <div className="relative">
                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="search"
                          placeholder="Search by user, session, or type..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-8"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Visibility</Label>
                      <Select value={filterVisible} onValueChange={setFilterVisible}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Records</SelectItem>
                          <SelectItem value="visible">Visible Only</SelectItem>
                          <SelectItem value="hidden">Hidden Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <Select value={filterType} onValueChange={setFilterType}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Types</SelectItem>
                          <SelectItem value="transcription">Transcription</SelectItem>
                          <SelectItem value="live_transcription">Live Transcription</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div className="flex items-end">
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setSearchTerm('');
                          setFilterVisible('all');
                          setFilterType('all');
                          setCurrentPage(1);
                        }}
                      >
                        <Filter className="h-4 w-4 mr-2" />
                        Clear Filters
                      </Button>
                    </div>
                  </div>
                  
                  <div className="mt-4 text-sm text-muted-foreground">
                    Showing {paginatedHistories.length} of {filteredHistories.length} records
                    {filteredHistories.length !== histories.length && ` (filtered from ${histories.length} total)`}
                  </div>
                </CardContent>
              </Card>

              {/* Error Display */}
              {error && (
                <Card className="mb-4 border-red-200 bg-red-50">
                  <CardContent className="pt-6">
                    <div className="text-red-700">{error}</div>
                  </CardContent>
                </Card>
              )}

              {/* Loading State */}
              {loading && (
                <Card>
                  <CardContent className="flex items-center justify-center py-12">
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      <span>Loading history...</span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* History Table */}
              {!loading && (
                <Card>
                  <CardContent className="p-0">
                    {paginatedHistories.length === 0 ? (
                      <div className="text-center py-12">
                        <HistoryIcon className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-muted-foreground">No history records found</h3>
                        <p className="text-sm text-muted-foreground mt-2">
                          {searchTerm || filterVisible !== 'all' || filterType !== 'all' 
                            ? 'Try adjusting your filters or search terms.'
                            : 'Start by creating some transcriptions to see history here.'
                          }
                        </p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Status</TableHead>
                            <TableHead>User ID</TableHead>
                            <TableHead>Session ID</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Transcriptions</TableHead>
                            <TableHead>Created</TableHead>
                            <TableHead>Visibility</TableHead>
                            <TableHead>Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {paginatedHistories.map((history) => (
                            <TableRow key={history.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  {getStatusIcon(history)}
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <User className="h-4 w-4 text-muted-foreground" />
                                  <span className="font-mono text-sm">{history.user_id}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Monitor className="h-4 w-4 text-muted-foreground" />
                                  <span className="font-mono text-sm">{history.session_id}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{history.type}</Badge>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <FileAudio className="h-4 w-4 text-muted-foreground" />
                                  <span>{history.transcriptions.length}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Clock className="h-4 w-4 text-muted-foreground" />
                                  <span className="text-sm">{formatDateTime(history.timestamp)}</span>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => toggleVisibility(history.id, history.visible)}
                                  className="h-8 w-8 p-0"
                                >
                                  {history.visible ? (
                                    <Eye className="h-4 w-4 text-green-600" />
                                  ) : (
                                    <EyeOff className="h-4 w-4 text-gray-400" />
                                  )}
                                </Button>
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleViewDetails(history.id)}
                                >
                                  View Details
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                  
                  {/* Pagination */}
                  {paginatedHistories.length > 0 && totalPages > 1 && (
                    <CardFooter className="flex items-center justify-between">
                      <div className="text-sm text-muted-foreground">
                        Page {currentPage} of {totalPages}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                          disabled={currentPage === totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </CardFooter>
                  )}
                </Card>
              )}
            </div>
          </div>
          
          {/* Footer */}
          <Footer />
          
          {/* Detail Modal */}
          <HistoryDetailModal
            isOpen={isModalOpen}
            onClose={handleCloseModal}
            historyId={selectedHistoryId}
          />
        </SidebarInset>
      </SidebarProvider>
    </ThemeProvider>
  );
}
