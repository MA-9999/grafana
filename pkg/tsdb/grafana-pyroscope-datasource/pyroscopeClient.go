package pyroscope

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/bufbuild/connect-go"
	querierv1 "github.com/grafana/phlare/api/gen/proto/go/querier/v1"
	"github.com/grafana/phlare/api/gen/proto/go/querier/v1/querierv1connect"
)

type ProfileType struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type Flamebearer struct {
	Names   []string
	Levels  []*Level
	Total   int64
	MaxSelf int64
}

type Level struct {
	Values []int64
}

type Series struct {
	Labels []*LabelPair
	Points []*Point
}

type LabelPair struct {
	Name  string
	Value string
}

type Point struct {
	Value float64
	// Milliseconds unix timestamp
	Timestamp int64
}

type ProfileResponse struct {
	Flamebearer *Flamebearer
	Units       string
}

type SeriesResponse struct {
	Series []*Series
	Units  string
	Label  string
}

type PyroscopeClient struct {
	connectClient querierv1connect.QuerierServiceClient
}

func NewPyroscopeClient(httpClient *http.Client, url string) *PyroscopeClient {
	return &PyroscopeClient{
		connectClient: querierv1connect.NewQuerierServiceClient(httpClient, url),
	}
}

func (c *PyroscopeClient) ProfileTypes(ctx context.Context) ([]*ProfileType, error) {
	res, err := c.connectClient.ProfileTypes(ctx, connect.NewRequest(&querierv1.ProfileTypesRequest{}))
	if err != nil {
		return nil, err
	}
	if res.Msg.ProfileTypes == nil {
		// Let's make sure we send at least empty array if we don't have any types
		return []*ProfileType{}, nil
	} else {
		pTypes := make([]*ProfileType, len(res.Msg.ProfileTypes))
		for i, pType := range res.Msg.ProfileTypes {
			pTypes[i] = &ProfileType{
				ID:    pType.ID,
				Label: pType.Name + " - " + pType.SampleType,
			}
		}
		return pTypes, nil
	}
}

func (c *PyroscopeClient) GetSeries(ctx context.Context, profileTypeID string, labelSelector string, start int64, end int64, groupBy []string, step float64) (*SeriesResponse, error) {
	req := connect.NewRequest(&querierv1.SelectSeriesRequest{
		ProfileTypeID: profileTypeID,
		LabelSelector: labelSelector,
		Start:         start,
		End:           end,
		Step:          step,
		GroupBy:       groupBy,
	})

	resp, err := c.connectClient.SelectSeries(ctx, req)
	if err != nil {
		return nil, err
	}

	series := make([]*Series, len(resp.Msg.Series))

	for i, s := range resp.Msg.Series {
		labels := make([]*LabelPair, len(s.Labels))
		for i, l := range s.Labels {
			labels[i] = &LabelPair{
				Name:  l.Name,
				Value: l.Value,
			}
		}

		points := make([]*Point, len(s.Points))
		for i, p := range s.Points {
			points[i] = &Point{
				Value:     p.Value,
				Timestamp: p.Timestamp,
			}
		}

		series[i] = &Series{
			Labels: labels,
			Points: points,
		}
	}

	parts := strings.Split(profileTypeID, ":")

	return &SeriesResponse{
		Series: series,
		Units:  getUnits(profileTypeID),
		Label:  parts[1],
	}, nil
}

func (c *PyroscopeClient) GetProfile(ctx context.Context, profileTypeID, labelSelector string, start, end int64, maxNodes *int64) (*ProfileResponse, error) {
	req := &connect.Request[querierv1.SelectMergeStacktracesRequest]{
		Msg: &querierv1.SelectMergeStacktracesRequest{
			ProfileTypeID: profileTypeID,
			LabelSelector: labelSelector,
			Start:         start,
			End:           end,
			MaxNodes:      maxNodes,
		},
	}

	resp, err := c.connectClient.SelectMergeStacktraces(ctx, req)
	if err != nil {
		return nil, err
	}

	if resp.Msg.Flamegraph == nil {
		// Not an error, can happen when querying data oout of range.
		return nil, nil
	}

	levels := make([]*Level, len(resp.Msg.Flamegraph.Levels))
	for i, level := range resp.Msg.Flamegraph.Levels {
		levels[i] = &Level{
			Values: level.Values,
		}
	}

	return &ProfileResponse{
		Flamebearer: &Flamebearer{
			Names:   resp.Msg.Flamegraph.Names,
			Levels:  levels,
			Total:   resp.Msg.Flamegraph.Total,
			MaxSelf: resp.Msg.Flamegraph.MaxSelf,
		},
		Units: getUnits(profileTypeID),
	}, nil
}

func getUnits(profileTypeID string) string {
	parts := strings.Split(profileTypeID, ":")
	unit := parts[2]
	if unit == "nanoseconds" {
		return "ns"
	}
	if unit == "count" {
		return "short"
	}
	return unit
}

func (c *PyroscopeClient) LabelNames(ctx context.Context) ([]string, error) {
	resp, err := c.connectClient.LabelNames(ctx, connect.NewRequest(&querierv1.LabelNamesRequest{}))
	if err != nil {
		return nil, fmt.Errorf("error seding LabelNames request %v", err)
	}

	var filtered []string
	for _, label := range resp.Msg.Names {
		if !isPrivateLabel(label) {
			filtered = append(filtered, label)
		}
	}

	return filtered, nil
}

func (c *PyroscopeClient) LabelValues(ctx context.Context, label string) ([]string, error) {
	resp, err := c.connectClient.LabelValues(ctx, connect.NewRequest(&querierv1.LabelValuesRequest{Name: label}))
	if err != nil {
		return nil, err
	}
	return resp.Msg.Names, nil
}

func isPrivateLabel(label string) bool {
	return strings.HasPrefix(label, "__")
}
